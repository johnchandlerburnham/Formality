var fmc = require("./FormalityCore.js");
var fml = require("./FormalityLang.js");

const Var = (name)           => ({ctor:"Var",name});
const Ref = (name)           => ({ctor:"Ref",name});
const Nul = ()               => ({ctor:"Nul"});
const Lam = (name,body)      => ({ctor:"Lam",name,body});
const App = (func,argm)      => ({ctor:"App",func,argm});
const Let = (name,expr,body) => ({ctor:"Let",name,expr,body});
const Eli = (prim,expr)      => ({ctor:"Eli",prim,expr});
const Ins = (prim,expr)      => ({ctor:"Ins",prim,expr});
const Chr = (chrx)           => ({ctor:"Chr",chrx});
const Str = (strx)           => ({ctor:"Str",strx});

var is_prim = {
  Unit   : 1,
  Bool   : 1,
  Nat    : 1,
  Bits   : 1,
  U16    : 1,
  U32    : 1,
  U64    : 1,
  F64    : 1,
  String : 1
};

function dependency_sort(defs, main) {
  var seen = {};
  var refs = [];
  function go(term) {
    switch (term.ctor) {
      case "Ref":
        if (!seen[term.name]) {
          seen[term.name] = true;
          go(defs[term.name].term);
          refs.push(term.name);
        }
        break;
      case "Lam":
        go(term.body(fmc.Var(term.name)));
        break;
      case "App":
        go(term.func);
        go(term.argm);
        break;
      case "Let":
        go(term.expr);
        go(term.body(fmc.Var(term.name)));
        break;
      case "Ann":
        go(term.expr);
        break;
      case "Loc":
        go(term.expr);
        break;
      default:
        break;
    };
  };
  go(defs[main].term);
  return refs;
};

function prim_of(type, defs) {
  for (var prim in is_prim) {
    if (fmc.equal(type, fmc.Ref(prim), defs)) {
      return prim;
    }
  };
  return null;
};

function infer(term, defs, ctx = fmc.Nil()) {
  //console.log("infer", term.ctor);
  switch (term.ctor) {
    case "Var":
      return {
        comp: Var(term.indx.split("#")[0]),
        type: fmc.Var(term.indx),
      };
    case "Ref":
      var got_def = defs[term.name];
      return {
        comp: Var(term.name),
        type: got_def.type,
      };
    case "Typ":
      return {
        comp: Nul(),
        type: fmc.Typ(),
      };
    case "App":
      var func_cmp = infer(term.func, defs, ctx);
      var func_typ = fmc.reduce(func_cmp.type, defs);
      switch (func_typ.ctor) {
        case "All":
          var self_var = fmc.Ann(true, term.func, func_typ);
          var name_var = fmc.Ann(true, term.argm, func_typ.bind);
          var argm_cmp = check(term.argm, func_typ.bind, defs, ctx);
          var term_typ = func_typ.body(self_var, name_var);
          var comp = func_cmp.comp;
          var func_typ_prim = prim_of(func_typ, defs);
          if (func_typ_prim) {
            comp = Eli(func_typ_prim, comp);
            //code = "elim_"+func_typ_prim.toLowerCase()+"("+code+")";
          };
          if (!term.eras) {
            comp = App(comp, argm_cmp.comp);
            //code = code+"("+argm_cmp.code+")";
          }
          return {comp, type: term_typ};
        default:
          throw "Non-function application.";
      };
    case "Let":
      var expr_cmp = infer(term.expr, defs, ctx);
      var expr_var = fmc.Ann(true, term.dups ? fmc.Var(term.name+"#"+(ctx.size+1)) : term.expr, expr_cmp.type);
      var body_ctx = fmc.Ext({name:term.name,type:expr_var.type}, ctx);
      var body_cmp = infer(term.body(expr_var), defs, body_ctx);
      return {
        comp: term.dups ? Let(term.name, expr_cmp.comp, body_cmp.comp) : body_cmp.comp,
        //code: "("+make_name(term.name)+"=>"+body_cmp.code+")("+expr_comp.code+")",
        type: body_cmp.type,
      };
    case "All":
      return {
        comp: Nul(),
        type: fmc.Typ(),
      };
    case "Ann":
      return check(term.expr, term.type, defs, ctx);
    case "Loc":
      return infer(term.expr, defs, ctx);
  }
};

function check(term, type, defs, ctx = fmc.Nil()) {
  var chr_lit = fml.stringify_chr(term);
  if (chr_lit) {
    var comp = Chr(chr_lit);
    var type = fmc.Ref("Char");
    return {comp, type};
  }
  
  var str_lit = fml.stringify_str(term);
  if (str_lit) {
    var comp = Str(str_lit);
    var type = fmc.Ref("String");
    return {comp, type};
  };

  var typv = fmc.reduce(type, defs);
  if (typv.ctor === "Typ") {
    var comp = Nul();
    var type = fmc.Typ();
    return {comp, type};
  };

  var comp = null;
  switch (term.ctor) {
    case "Lam":
      if (typv.ctor === "All") {
        var self_var = fmc.Ann(true, term, type);
        var name_var = fmc.Ann(true, fmc.Var(term.name+"#"+(ctx.size+1)), typv.bind);
        var body_typ = typv.body(self_var, name_var);
        var body_ctx = fmc.Ext({name:term.name,type:name_var.type}, ctx);
        var body_cmp = check(term.body(name_var), body_typ, defs, body_ctx);
        if (term.eras) {
          comp = body_cmp.comp;
        } else {
          comp = Lam(term.name, body_cmp.comp);
          //var code = "("+make_name(term.name)+"=>"+body_cmp.code+")";
        }
        var type_prim = prim_of(type, defs);
        if (type_prim) {
          comp = Ins(type_prim, comp);
          //code = "inst_"+type_prim.toLowerCase()+"("+code+")";
        };
      } else {
        throw "Lambda has non-function type.";
      }
      return {comp, type};
    case "Let":
      var expr_cmp = infer(term.expr, defs, ctx);
      var expr_var = fmc.Ann(true, term.dups ? fmc.Var(term.name+"#"+(ctx.size+1)) : term.expr, expr_cmp.type);
      var body_ctx = fmc.Ext({name:term.name,type:expr_var.type}, ctx);
      var body_cmp = check(term.body(expr_var), type, defs, body_ctx);
      return {
        comp: term.dups ? Let(term.name, expr_cmp.comp, body_cmp.comp) : body_cmp.comp,
        //code: "("+make_name(term.name)+"=>"+body_cmp.code+")("+expr_comp.code+")",
        type: body_cmp.type,
      };
    case "Loc":
      return check(term.expr, type, defs);
    default:
      var term_cmp = infer(term, defs, ctx);
      var comp = term_cmp.comp;
      return {comp, type};
  };
};

function core_to_comp(defs, main) {
  var comp_nams = dependency_sort(defs, main).concat([main]);
  var comp_defs = {};
  for (var name of comp_nams) {
    // TODO: caution, using fml.unloc on fmc term; consider adding fmc.unloc
    comp_defs[name] = check(fml.unloc(defs[name].term), fml.unloc(defs[name].type), defs).comp;
  };
  return {
    defs: comp_defs,
    nams: comp_nams,
  };
};

module.exports = {
  Var, Ref, Nul, Lam,
  App, Let, Eli, Ins,
  Chr, Str,
  is_prim,
  dependency_sort,
  check,
  infer,
  core_to_comp,
};
